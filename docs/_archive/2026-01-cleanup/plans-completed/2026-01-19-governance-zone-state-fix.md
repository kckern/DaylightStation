# Governance Zone State Fix - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix governance rapid cycling by reading zone state from ZoneProfileStore instead of TreasureBox.

**Architecture:** Remove reactive governance evaluation triggered by TreasureBox zone changes. Instead, governance reads stable zone state from ZoneProfileStore during tick-driven evaluation. This aligns governance with UI (both use same source) and limits phase transitions to 5-second tick boundaries.

**Tech Stack:** JavaScript/ES6, Jest for testing

---

**Date:** 2026-01-19
**Status:** Complete
**Problem:** Governance phase cycling 47 times in 15 minutes with <100ms warning durations

**Implementation Summary:**
- Task 1: `330bbd20` - Added TDD test for ZoneProfileStore zone source
- Task 2: `bb6a27d5` - Modified GovernanceEngine to read zones from ZoneProfileStore
- Task 3: `dc7388eb` - Removed reactive governance callback from TreasureBox
- Task 4: `48bf78a8` - Deprecated _evaluateFromTreasureBox method
- Task 5: `6188ec67` - Added phase stability integration tests

---

## Problem Summary

Governance reads zone state from the wrong source, causing rapid phase cycling when heart rate fluctuates near zone boundaries.

---

## AS-IS Architecture

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    HR Reading Arrives                    │
                    └─────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                    ┌─────────────────────────────────────────────────────────┐
                    │                     TreasureBox                          │
                    │                 recordUserHeartRate()                    │
                    └─────────────────────────────────────────────────────────┘
                                              │
                         ┌────────────────────┴────────────────────┐
                         │                                         │
                         ▼                                         ▼
          ┌──────────────────────────────┐          ┌──────────────────────────────┐
          │      Coin Accumulation       │          │       Zone State Update      │
          │   (highestZone tracking)     │          │   (lastZoneId, lastColor)    │
          │                              │          │                              │
          │  • Tracks highest zone       │          │  • Updates on EVERY reading  │
          │  • Resets every 5 seconds    │          │  • Can go UP within interval │
          │  • Awards coins at interval  │          │  • Resets at interval end    │
          └──────────────────────────────┘          └──────────────────────────────┘
                                                                   │
                                                                   │ Zone changed?
                                                                   ▼
                                                    ┌──────────────────────────────┐
                                                    │     _notifyGovernance()      │
                                                    │   (reactive notification)    │
                                                    └──────────────────────────────┘
                                                                   │
                                                                   ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              GovernanceEngine                                        │
│                         _evaluateFromTreasureBox()                                   │
│                                                                                      │
│   snapshot = treasureBox.getLiveSnapshot()                                          │
│                     │                                                                │
│                     ▼                                                                │
│   ┌─────────────────────────────────────────┐                                       │
│   │  userZoneMap[userId] = snapshot.zoneId  │  ◄── PROBLEM: Uses volatile lastZoneId│
│   └─────────────────────────────────────────┘                                       │
│                     │                                                                │
│                     ▼                                                                │
│   ┌─────────────────────────────────────────┐                                       │
│   │  "All warm?" → Check userZoneMap        │                                       │
│   │  → allSatisfied = true/false            │                                       │
│   └─────────────────────────────────────────┘                                       │
│                     │                                                                │
│                     ▼                                                                │
│   ┌─────────────────────────────────────────┐                                       │
│   │  Phase transition: unlocked ↔ warning   │  ◄── Cycles rapidly!                  │
│   └─────────────────────────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘


SEPARATELY (disconnected):

┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              UI Display Path                                         │
│                                                                                      │
│   Every 5 seconds (_collectTimelineTick):                                           │
│                                                                                      │
│   allUsers = userManager.getAllUsers()                                              │
│        │                                                                             │
│        ▼                                                                             │
│   ┌─────────────────────────────────────────┐                                       │
│   │  ZoneProfileStore.syncFromUsers()       │                                       │
│   │  → deriveZoneProgressSnapshot()         │                                       │
│   │  → currentZoneId (stable, tick-aligned) │                                       │
│   └─────────────────────────────────────────┘                                       │
│        │                                                                             │
│        ▼                                                                             │
│   ┌─────────────────────────────────────────┐                                       │
│   │  UI reads zoneProfiles                  │  ◄── Stable! Only changes every 5s   │
│   │  → Sidebar badges show zone color       │                                       │
│   └─────────────────────────────────────────┘                                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### The Bug: Interval Reset Causes Zone Drop

```
Timeline (5-second coin interval):

0ms     1000ms   2000ms   3000ms   4000ms   5000ms   5100ms   5200ms
│       │        │        │        │        │        │        │
▼       ▼        ▼        ▼        ▼        ▼        ▼        ▼
HR=142  HR=145   HR=138   HR=144   HR=141   ║        HR=138   HR=143
zone=   zone=    zone=    zone=    zone=    ║        zone=    zone=
warm    warm     warm     warm     warm     ║        ACTIVE!  warm
        (higher) (ignored)(ignored)(ignored)║        ▲        ▲
                                            ║        │        │
                                    INTERVAL END     │        │
                                    highestZone=null │        │
                                    ════════════════╝        │
                                                             │
                                    First reading after      │
                                    reset: ANY zone qualifies│
                                    lastZoneId = "active"    │
                                    → Governance notified    │
                                    → Phase = WARNING        │
                                                             │
                                              Next reading:  │
                                              warm > active  │
                                              lastZoneId = "warm"
                                              → Governance notified
                                              → Phase = UNLOCKED

Result: WARNING phase lasted ~100ms
```

---

## TO-BE Architecture

```
                    ┌─────────────────────────────────────────────────────────┐
                    │                    HR Reading Arrives                    │
                    └─────────────────────────────────────────────────────────┘
                                              │
                         ┌────────────────────┴────────────────────┐
                         │                                         │
                         ▼                                         ▼
          ┌──────────────────────────────┐          ┌──────────────────────────────┐
          │        TreasureBox           │          │        UserManager           │
          │   (Coin Accumulation ONLY)   │          │   (User Data Including HR)   │
          │                              │          │                              │
          │  • highestZone for coins     │          │  • currentData.heartRate     │
          │  • No governance callback    │          │  • Updated on every reading  │
          └──────────────────────────────┘          └──────────────────────────────┘
                                                                   │
                                                                   │
                    ┌──────────────────────────────────────────────┘
                    │
                    │  Every 5 seconds (_collectTimelineTick)
                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            ZoneProfileStore                                          │
│                     (SINGLE SOURCE OF TRUTH)                                         │
│                                                                                      │
│   syncFromUsers(allUsers)                                                           │
│        │                                                                             │
│        ▼                                                                             │
│   ┌─────────────────────────────────────────┐                                       │
│   │  For each user:                         │                                       │
│   │    deriveZoneProgressSnapshot()         │                                       │
│   │    → currentZoneId                      │                                       │
│   │    → currentZoneColor                   │                                       │
│   │    → progress (0-1 within zone)         │                                       │
│   └─────────────────────────────────────────┘                                       │
│        │                                                                             │
│        │  Zone state changes only at 5-second boundaries                            │
│        │                                                                             │
│        ├───────────────────────────────────────────────────────┐                    │
│        │                                                       │                    │
│        ▼                                                       ▼                    │
│   ┌─────────────────────────────┐              ┌─────────────────────────────┐      │
│   │  UI (Sidebar, Badges)       │              │  GovernanceEngine           │      │
│   │                             │              │                             │      │
│   │  zoneProfiles.currentZoneId │              │  zoneProfileStore           │      │
│   │  → Display zone colors      │              │    .getProfile(userId)      │      │
│   │                             │              │    .currentZoneId           │      │
│   └─────────────────────────────┘              │  → Evaluate requirements    │      │
│                                                └─────────────────────────────┘      │
│                                                                                      │
│   BOTH read from the SAME source → UI and Governance always agree                   │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### New Evaluation Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         GovernanceEngine.evaluate()                                  │
│                                                                                      │
│   // Called every 5 seconds (tick-driven, not reactive)                             │
│                                                                                      │
│   const zoneProfileStore = this.session.zoneProfileStore;                           │
│                                                                                      │
│   activeParticipants.forEach(userId => {                                            │
│       const profile = zoneProfileStore.getProfile(userId);                          │
│       userZoneMap[userId] = profile?.currentZoneId || null;                         │
│   });                                                                                │
│                                                                                      │
│   // Now evaluate requirements against stable zone state                            │
│   const { allSatisfied } = this._evaluateRequirementSet(...);                       │
│                                                                                      │
│   // Phase transitions only possible at tick boundaries                             │
│   if (allSatisfied) {                                                               │
│       this._setPhase('unlocked');                                                   │
│   } else {                                                                          │
│       // Grace period logic...                                                      │
│   }                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Changes

| Aspect | AS-IS | TO-BE |
|--------|-------|-------|
| Zone state source for Governance | `TreasureBox.lastZoneId` | `ZoneProfileStore.currentZoneId` |
| Zone state update frequency | Every HR reading (~100ms) | Every tick (5 seconds) |
| Governance evaluation trigger | Reactive (on zone change) | Tick-driven (every 5 seconds) |
| UI/Governance agreement | Different sources → can disagree | Same source → always agree |
| Minimum phase duration | ~100ms (1 HR reading) | 5 seconds (1 tick) |

---

## Benefits

1. **Eliminates rapid cycling** - Phase can only change every 5 seconds
2. **UI consistency** - What you see is what governance sees
3. **Simpler mental model** - Zones are stable states, not transient events
4. **Existing code reuse** - ZoneProfileStore already exists and works
5. **Minimal changes** - Only need to change governance's data source

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| 5-second delay feels unresponsive | Already the case for UI; users are used to it |
| Governance misses rapid zone changes | Intentional - rapid changes are noise, not signal |
| Breaking change for existing behavior | Grace period logic unchanged; only source changes |

---

## Implementation Tasks

### Task 1: Write test for governance using ZoneProfileStore

**Files:**
- Create: `tests/unit/fitness/governance-zone-source.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

// Mock ZoneProfileStore
const mockGetProfile = jest.fn();
const mockZoneProfileStore = {
  getProfile: mockGetProfile
};

// Mock session with zoneProfileStore
const createMockSession = (zoneProfileStore) => ({
  zoneProfileStore,
  roster: [],
  treasureBox: null
});

describe('GovernanceEngine zone source', () => {
  beforeEach(() => {
    mockGetProfile.mockClear();
  });

  test('reads zone state from ZoneProfileStore, not TreasureBox', async () => {
    // Setup: ZoneProfileStore returns 'warm' for user
    mockGetProfile.mockReturnValue({
      id: 'user-1',
      currentZoneId: 'warm',
      currentZoneColor: 'yellow'
    });

    // Import GovernanceEngine
    const { GovernanceEngine } = await import(
      '../../../frontend/src/hooks/fitness/GovernanceEngine.js'
    );

    const session = createMockSession(mockZoneProfileStore);
    const engine = new GovernanceEngine(session);

    // Configure with a policy requiring 'warm' zone
    engine.configure({
      governedLabels: ['fitness'],
      policies: [{
        id: 'test-policy',
        minParticipants: 1,
        baseRequirement: { warm: 'all' }
      }]
    });

    engine.setMedia({ id: 'test', label: 'fitness' });

    // Evaluate with one active participant
    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {}, // Empty - should be populated from ZoneProfileStore
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { warm: { id: 'warm', name: 'Warm', color: 'yellow' } },
      totalCount: 1
    });

    // Verify ZoneProfileStore was consulted
    expect(mockGetProfile).toHaveBeenCalledWith('user-1');

    // Verify phase is unlocked (requirement satisfied via ZoneProfileStore)
    expect(engine.phase).toBe('unlocked');
  });

  test('zone state only changes at tick boundaries, not per HR reading', async () => {
    // This test verifies the architectural guarantee:
    // ZoneProfileStore only updates every 5 seconds (tick-driven)
    // So governance phase can only change at tick boundaries

    mockGetProfile
      .mockReturnValueOnce({ id: 'user-1', currentZoneId: 'active' }) // First tick
      .mockReturnValueOnce({ id: 'user-1', currentZoneId: 'warm' });  // Second tick

    const { GovernanceEngine } = await import(
      '../../../frontend/src/hooks/fitness/GovernanceEngine.js'
    );

    const session = createMockSession(mockZoneProfileStore);
    const engine = new GovernanceEngine(session);

    engine.configure({
      governedLabels: ['fitness'],
      policies: [{
        id: 'test-policy',
        minParticipants: 1,
        baseRequirement: { warm: 'all' }
      }]
    });

    engine.setMedia({ id: 'test', label: 'fitness' });

    const zoneRankMap = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
    const zoneInfoMap = { warm: { id: 'warm', name: 'Warm' } };

    // First evaluation - user in 'active' zone (below warm)
    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {},
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    expect(engine.phase).toBe('pending'); // Not satisfied yet

    // Second evaluation (simulating next tick) - user now in 'warm' zone
    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {},
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    expect(engine.phase).toBe('unlocked'); // Now satisfied
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/fitness/governance-zone-source.unit.test.mjs --verbose`
Expected: FAIL - GovernanceEngine doesn't read from ZoneProfileStore yet

**Step 3: Commit test file**

```bash
git add tests/unit/fitness/governance-zone-source.unit.test.mjs
git commit -m "test(governance): add tests for ZoneProfileStore zone source"
```

---

### Task 2: Modify GovernanceEngine to read zones from ZoneProfileStore

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:833-860`

**Step 1: Update evaluate() to populate userZoneMap from ZoneProfileStore**

Find the `evaluate()` method (around line 833) and modify the section after "If no data passed in, read directly from session.roster" to also populate `userZoneMap` from `ZoneProfileStore`:

```javascript
  evaluate({ activeParticipants, userZoneMap, zoneRankMap, zoneInfoMap, totalCount } = {}) {
    const now = Date.now();
    const hasGovernanceRules = (this._governedLabelSet.size + this._governedTypeSet.size) > 0;

    // If no data passed in, read directly from session.roster
    if (!activeParticipants && this.session?.roster) {
      const roster = this.session.roster || [];
      activeParticipants = roster
        .filter((entry) => entry.isActive !== false && (entry.id || entry.profileId))
        .map((entry) => entry.id || entry.profileId);

      userZoneMap = {};
      roster.forEach((entry) => {
        const participantId = entry.id || entry.profileId;
        if (participantId) {
          userZoneMap[participantId] = entry.zoneId || null;
        }
      });

      totalCount = activeParticipants.length;
    }

    // Ensure defaults
    activeParticipants = activeParticipants || [];
    userZoneMap = userZoneMap || {};
    zoneRankMap = zoneRankMap || {};
    zoneInfoMap = zoneInfoMap || {};
    totalCount = totalCount || activeParticipants.length;

    // NEW: Populate userZoneMap from ZoneProfileStore (stable, tick-aligned zone state)
    // This overrides any volatile zone data with the stable source used by UI
    if (this.session?.zoneProfileStore) {
      activeParticipants.forEach((participantId) => {
        const profile = this.session.zoneProfileStore.getProfile(participantId);
        if (profile?.currentZoneId) {
          userZoneMap[participantId] = profile.currentZoneId.toLowerCase();
        }
      });
    }

    // ... rest of evaluate() unchanged ...
```

**Step 2: Run test to verify it passes**

Run: `npm test -- tests/unit/fitness/governance-zone-source.unit.test.mjs --verbose`
Expected: PASS

**Step 3: Run full test suite to check for regressions**

Run: `npm test -- --testPathPattern="fitness" --verbose`
Expected: All tests pass

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "feat(governance): read zone state from ZoneProfileStore

Zone state now comes from ZoneProfileStore (stable, tick-aligned)
instead of being passed in or read from volatile sources.
This ensures governance sees the same zone state as the UI."
```

---

### Task 3: Remove reactive governance callback from TreasureBox

**Files:**
- Modify: `frontend/src/hooks/fitness/TreasureBox.js:508-510` (remove _notifyGovernance call)
- Modify: `frontend/src/hooks/fitness/TreasureBox.js:706-718` (remove callback methods)

**Step 1: Remove _notifyGovernance() call from recordUserHeartRate()**

In `recordUserHeartRate()` (around line 498-512), remove the governance notification on zone change:

```javascript
    if (zone) {
      const previousZoneId = acc.lastZoneId;
      if (!acc.highestZone || zone.min > acc.highestZone.min) {
        this._log('update_highest_zone', { accKey, zone: { id: zone.id, name: zone.name } });
        acc.highestZone = zone;
        acc.currentColor = zone.color;
        acc.lastColor = zone.color; // update persistent last color
        acc.lastZoneId = zone.id || zone.name || null;

        // REMOVED: Reactive governance notification
        // Governance now reads from ZoneProfileStore on tick boundaries
        // if (acc.lastZoneId !== previousZoneId) {
        //   this._notifyGovernance();
        // }
      }
    }
```

**Step 2: Remove governance callback methods**

Remove or comment out the following methods (around lines 706-718):

```javascript
  /**
   * DEPRECATED: Governance callback removed.
   * Governance now reads zone state from ZoneProfileStore on tick boundaries.
   * Keeping method stub for backward compatibility.
   *
   * @param {Function|null} callback
   * @deprecated
   */
  setGovernanceCallback(callback) {
    // No-op: Governance callback removed - now tick-driven via ZoneProfileStore
    if (callback) {
      getLogger().warn('treasurebox.governance_callback_deprecated', {
        message: 'Governance now reads from ZoneProfileStore on tick boundaries'
      });
    }
  }

  // REMOVED: _notifyGovernance() - no longer needed
  // _notifyGovernance() {
  //   if (this._governanceCb) {
  //     try { this._governanceCb(); } catch (_) { /* ignore */ }
  //   }
  // }
```

**Step 3: Run tests**

Run: `npm test -- --testPathPattern="fitness" --verbose`
Expected: All tests pass (some may need adjustment if they test the callback)

**Step 4: Commit**

```bash
git add frontend/src/hooks/fitness/TreasureBox.js
git commit -m "refactor(treasurebox): remove reactive governance callback

Governance now reads zone state from ZoneProfileStore on tick boundaries.
Removed _notifyGovernance() and deprecated setGovernanceCallback().
This eliminates the source of rapid phase cycling."
```

---

### Task 4: Remove _evaluateFromTreasureBox from GovernanceEngine

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:494-536`

**Step 1: Deprecate _evaluateFromTreasureBox()**

Replace the method with a deprecated stub:

```javascript
  /**
   * DEPRECATED: Reactive evaluation from TreasureBox removed.
   * Governance now evaluates on tick boundaries using ZoneProfileStore.
   *
   * @deprecated Use evaluate() called from session tick instead
   */
  _evaluateFromTreasureBox() {
    // No-op: Reactive evaluation removed
    // Governance now runs on tick boundaries via session._collectTimelineTick()
    // and reads stable zone state from ZoneProfileStore
    getLogger().warn('governance.evaluate_from_treasurebox_deprecated', {
      message: 'Governance now tick-driven via ZoneProfileStore'
    });

    // Fallback: Just call regular evaluate() if someone still calls this
    this.evaluate();
  }
```

**Step 2: Run tests**

Run: `npm test -- --testPathPattern="fitness" --verbose`
Expected: All tests pass

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "refactor(governance): deprecate reactive _evaluateFromTreasureBox

Governance evaluation is now tick-driven via session._collectTimelineTick().
Zone state comes from ZoneProfileStore (stable, tick-aligned).
Kept method as deprecated stub for backward compatibility."
```

---

### Task 5: Add integration test for phase stability

**Files:**
- Create: `tests/unit/fitness/governance-phase-stability.unit.test.mjs`

**Step 1: Write integration test verifying no rapid cycling**

```javascript
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

describe('GovernanceEngine phase stability', () => {
  test('phase cannot cycle faster than tick interval (5 seconds)', async () => {
    // This test simulates what was happening before the fix:
    // Rapid HR fluctuations causing rapid phase transitions
    // After fix: phase only changes at tick boundaries

    const mockGetProfile = jest.fn();
    const mockZoneProfileStore = { getProfile: mockGetProfile };

    const { GovernanceEngine } = await import(
      '../../../frontend/src/hooks/fitness/GovernanceEngine.js'
    );

    const session = {
      zoneProfileStore: mockZoneProfileStore,
      roster: [],
      treasureBox: null
    };

    const engine = new GovernanceEngine(session);

    engine.configure({
      governedLabels: ['fitness'],
      policies: [{
        id: 'test-policy',
        minParticipants: 1,
        baseRequirement: { warm: 'all', grace_period_seconds: 10 }
      }]
    });

    engine.setMedia({ id: 'test', label: 'fitness' });

    const zoneRankMap = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
    const zoneInfoMap = {
      warm: { id: 'warm', name: 'Warm' },
      active: { id: 'active', name: 'Active' }
    };

    // Simulate: User starts in warm zone
    mockGetProfile.mockReturnValue({ id: 'user-1', currentZoneId: 'warm' });

    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {},
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    expect(engine.phase).toBe('unlocked');
    const phaseHistory = [engine.phase];

    // Simulate: 10 rapid evaluations within same "tick"
    // (in reality these would be triggered by HR readings)
    // ZoneProfileStore returns same value because it only updates on ticks
    for (let i = 0; i < 10; i++) {
      engine.evaluate({
        activeParticipants: ['user-1'],
        userZoneMap: {},
        zoneRankMap,
        zoneInfoMap,
        totalCount: 1
      });
      phaseHistory.push(engine.phase);
    }

    // Verify: Phase stayed stable (all 'unlocked')
    expect(phaseHistory.every(p => p === 'unlocked')).toBe(true);

    // Simulate: Next tick - ZoneProfileStore now returns 'active' (below warm)
    mockGetProfile.mockReturnValue({ id: 'user-1', currentZoneId: 'active' });

    engine.evaluate({
      activeParticipants: ['user-1'],
      userZoneMap: {},
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // NOW phase changes (at tick boundary)
    expect(engine.phase).toBe('warning');
  });

  test('TreasureBox zone changes do not trigger governance evaluation', async () => {
    // Verify the architectural change: TreasureBox no longer notifies governance

    const { FitnessTreasureBox } = await import(
      '../../../frontend/src/hooks/fitness/TreasureBox.js'
    );

    const mockSession = { _log: jest.fn() };
    const box = new FitnessTreasureBox(mockSession);

    // Setup zones
    box.configure({
      coinTimeUnitMs: 5000,
      zones: [
        { id: 'active', name: 'Active', min: 100, color: 'blue', coins: 1 },
        { id: 'warm', name: 'Warm', min: 140, color: 'yellow', coins: 2 }
      ]
    });

    // Set a governance callback (should be ignored now)
    const governanceCallback = jest.fn();
    box.setGovernanceCallback(governanceCallback);

    // Record HR readings that would have triggered zone changes
    box.recordUserHeartRate('user-1', 130); // active zone
    box.recordUserHeartRate('user-1', 145); // warm zone (zone change!)
    box.recordUserHeartRate('user-1', 135); // back to active (zone change!)

    // Verify: Governance callback was NOT called
    expect(governanceCallback).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npm test -- tests/unit/fitness/governance-phase-stability.unit.test.mjs --verbose`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/unit/fitness/governance-phase-stability.unit.test.mjs
git commit -m "test(governance): add phase stability integration tests

Verifies:
- Phase cannot cycle faster than tick interval
- TreasureBox zone changes no longer trigger governance
- ZoneProfileStore is the single source of zone truth for governance"
```

---

### Task 6: Update documentation

**Files:**
- Modify: `docs/plans/2026-01-19-governance-zone-state-fix.md` (mark as complete)

**Step 1: Update status to Complete**

Change the status line from "Plan" to "Complete" and add implementation summary.

**Step 2: Commit**

```bash
git add docs/plans/2026-01-19-governance-zone-state-fix.md
git commit -m "docs(governance): mark zone state fix as complete"
```

---

## Verification

After all tasks complete, verify the fix:

1. **Run full test suite:**
   ```bash
   npm test -- --testPathPattern="fitness" --verbose
   ```

2. **Manual verification (if possible):**
   - Start a fitness session
   - Watch governance phase in UI
   - Fluctuate HR around zone boundary
   - Verify phase only changes every ~5 seconds, not rapidly

3. **Check logs:**
   - No `governance.evaluate_from_treasurebox` calls
   - No rapid phase transition logs
   - `governance.phase_change` logs spaced at least 5 seconds apart

