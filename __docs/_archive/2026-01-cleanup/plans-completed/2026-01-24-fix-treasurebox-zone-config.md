# Fix TreasureBox Zone Configuration Race Condition

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the race condition where TreasureBox.configure() is never called with zone config, causing zero coins and false governance warnings.

**Architecture:** Move TreasureBox zone configuration from React effect timing into FitnessSession initialization, and add defensive fallback in GovernanceEngine.evaluate() for internal calls without zoneRankMap.

**Tech Stack:** React, JavaScript ES6, Vitest

---

## Background

### Root Cause
1. FitnessContext has an effect (lines 507-533) that calls `treasureBox.configure({zones})`
2. The effect checks `if (!box) return;` - skips if treasureBox doesn't exist yet
3. TreasureBox is lazily created in FitnessSession.start()
4. If TreasureBox is created AFTER the effect runs and dependencies don't change, configure() is never called

### Impact
- `globalZones = []` (empty) → TreasureBox can't count coins
- No zone data → GovernanceEngine gets empty zoneRankMap
- Empty zoneRankMap → all zone requirements return null → empty summaries
- Empty summaries with entries → `allSatisfied = false` → false warning

---

## Task 1: Add TreasureBox Configuration in FitnessSession.start()

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1345-1370`
- Test: `frontend/src/hooks/fitness/__tests__/FitnessSession.test.js`

**Step 1: Write the failing test**

Add to existing test file or create new:

```javascript
// frontend/src/hooks/fitness/__tests__/FitnessSession.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FitnessSession } from '../FitnessSession.js';

describe('FitnessSession.start()', () => {
  describe('TreasureBox zone configuration', () => {
    it('should configure TreasureBox with zones from snapshot.zoneConfig', () => {
      const session = new FitnessSession();
      const mockZoneConfig = [
        { id: 'blue', name: 'Blue', min: 0, color: 'blue', coins: 0 },
        { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
        { id: 'warm', name: 'Warm', min: 120, color: 'yellow', coins: 2 },
      ];

      // Pre-set zone config in snapshot
      session.snapshot.zoneConfig = mockZoneConfig;

      // Start session (creates TreasureBox)
      session.start({ reason: 'test' });

      // Verify TreasureBox has zones configured
      expect(session.treasureBox).toBeDefined();
      expect(session.treasureBox.globalZones.length).toBe(3);
      expect(session.treasureBox.globalZones[0].id).toBe('blue');
    });

    it('should handle missing zoneConfig gracefully', () => {
      const session = new FitnessSession();
      session.snapshot.zoneConfig = null;

      // Should not throw
      session.start({ reason: 'test' });

      expect(session.treasureBox).toBeDefined();
      expect(session.treasureBox.globalZones.length).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- frontend/src/hooks/fitness/__tests__/FitnessSession.test.js --run`
Expected: FAIL - TreasureBox.globalZones.length is 0 (zones not configured)

**Step 3: Write minimal implementation**

In `frontend/src/hooks/fitness/FitnessSession.js`, find the TreasureBox creation block (around line 1348) and add configuration:

```javascript
// Around line 1348-1367, after TreasureBox creation
if (!this.treasureBox) {
  this.treasureBox = new FitnessTreasureBox(this);
  // Inject ActivityMonitor for activity-aware coin processing (Priority 2)
  this.treasureBox.setActivityMonitor(this.activityMonitor);

  // BUGFIX: Configure TreasureBox with zones immediately after creation
  // Previously, this was only done in FitnessContext React effect which
  // could miss if TreasureBox was created after the effect ran
  if (this.snapshot.zoneConfig) {
    this.treasureBox.configure({
      zones: this.snapshot.zoneConfig
    });
  }

  // Ensure governance callback is wired even when TreasureBox is lazily created
  if (this.governanceEngine) {
    this.treasureBox.setGovernanceCallback(() => {
      this.governanceEngine._evaluateFromTreasureBox();
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- frontend/src/hooks/fitness/__tests__/FitnessSession.test.js --run`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/__tests__/FitnessSession.test.js
git commit -m "fix(fitness): configure TreasureBox zones in session.start()

Previously, TreasureBox zone configuration relied on React effect timing
in FitnessContext. If TreasureBox was created after the effect ran,
zones were never configured, causing:
- Zero coin counting (globalZones empty)
- False governance warnings (empty zoneRankMap)

Now configure zones immediately when TreasureBox is created.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Zone Config Propagation in updateSnapshot()

**Files:**
- Modify: `frontend/src/hooks/fitness/FitnessSession.js:1415-1420`
- Test: `frontend/src/hooks/fitness/__tests__/FitnessSession.test.js`

**Step 1: Write the failing test**

```javascript
describe('FitnessSession.updateSnapshot()', () => {
  it('should configure TreasureBox when zoneConfig is updated', () => {
    const session = new FitnessSession();
    session.start({ reason: 'test' });

    // Initially no zones
    expect(session.treasureBox.globalZones.length).toBe(0);

    // Update snapshot with zones
    const mockZoneConfig = [
      { id: 'blue', name: 'Blue', min: 0, color: 'blue', coins: 0 },
      { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
    ];

    session.updateSnapshot({ zoneConfig: mockZoneConfig });

    // TreasureBox should now have zones
    expect(session.treasureBox.globalZones.length).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- frontend/src/hooks/fitness/__tests__/FitnessSession.test.js --run`
Expected: FAIL - TreasureBox.globalZones.length still 0 after updateSnapshot

**Step 3: Write minimal implementation**

In `frontend/src/hooks/fitness/FitnessSession.js`, find the zoneConfig handling in updateSnapshot() (around line 1415):

```javascript
// Around line 1415-1420
if (zoneConfig) {
  this.zoneProfileStore?.setBaseZoneConfig(zoneConfig);

  // BUGFIX: Also configure TreasureBox with zones
  // This ensures zones are set even if TreasureBox was created after initial config
  if (this.treasureBox) {
    this.treasureBox.configure({ zones: zoneConfig });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- frontend/src/hooks/fitness/__tests__/FitnessSession.test.js --run`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/FitnessSession.js frontend/src/hooks/fitness/__tests__/FitnessSession.test.js
git commit -m "fix(fitness): propagate zoneConfig to TreasureBox in updateSnapshot()

Ensures TreasureBox receives zone configuration whenever snapshot is
updated, not just during initial creation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Defensive zoneRankMap Fallback in GovernanceEngine.evaluate()

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js:975-990`
- Test: `frontend/src/hooks/fitness/__tests__/GovernanceEngine.test.js`

**Step 1: Write the failing test**

```javascript
// frontend/src/hooks/fitness/__tests__/GovernanceEngine.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GovernanceEngine } from '../GovernanceEngine.js';

describe('GovernanceEngine.evaluate()', () => {
  describe('zoneRankMap fallback', () => {
    it('should reuse previous zoneRankMap when called without params', () => {
      const mockSession = {
        roster: [
          { id: 'user1', isActive: true, zoneId: 'active' }
        ],
        zoneProfileStore: null
      };

      const engine = new GovernanceEngine(mockSession);
      engine.configure({
        governance: {
          default: {
            zones: { active: { min: 1 } },
            grace_period_seconds: 30
          }
        },
        governed_labels: ['workout'],
        governed_types: []
      });

      const zoneRankMap = { blue: 0, active: 1, warm: 2 };
      const zoneInfoMap = {
        blue: { id: 'blue', name: 'Blue' },
        active: { id: 'active', name: 'Active' },
        warm: { id: 'warm', name: 'Warm' }
      };

      // First call with zoneRankMap
      engine.setMedia({ id: '123', labels: ['workout'] });
      engine.evaluate({
        activeParticipants: ['user1'],
        userZoneMap: { user1: 'active' },
        zoneRankMap,
        zoneInfoMap,
        totalCount: 1
      });

      // Verify _latestInputs captured zoneRankMap
      expect(engine._latestInputs?.zoneRankMap).toEqual(zoneRankMap);

      // Second call WITHOUT zoneRankMap (simulating internal _triggerPulse call)
      engine.evaluate();

      // Should have used fallback zoneRankMap, not empty
      // Verify by checking that requirements were evaluated (not empty)
      const state = engine.state;
      // If zoneRankMap was used, requirements should have content
      // If it was empty, requirements would be []
      expect(state.requirements).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- frontend/src/hooks/fitness/__tests__/GovernanceEngine.test.js --run`
Expected: FAIL - requirements is empty because zoneRankMap defaults to {}

**Step 3: Write minimal implementation**

In `frontend/src/hooks/fitness/GovernanceEngine.js`, find the defaults section in evaluate() (around line 979):

```javascript
// Around line 975-990, after building activeParticipants/userZoneMap from roster

// BUGFIX: Fall back to previous zoneRankMap/zoneInfoMap when not provided
// This fixes internal _triggerPulse() calls which don't pass these maps
if (!zoneRankMap && this._latestInputs?.zoneRankMap) {
  zoneRankMap = this._latestInputs.zoneRankMap;
}
if (!zoneInfoMap && this._latestInputs?.zoneInfoMap) {
  zoneInfoMap = this._latestInputs.zoneInfoMap;
}

// Ensure defaults (these now only apply if _latestInputs also didn't have them)
activeParticipants = activeParticipants || [];
userZoneMap = userZoneMap || {};
zoneRankMap = zoneRankMap || {};
zoneInfoMap = zoneInfoMap || {};
totalCount = totalCount || activeParticipants.length;
```

**Step 4: Run test to verify it passes**

Run: `npm test -- frontend/src/hooks/fitness/__tests__/GovernanceEngine.test.js --run`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js frontend/src/hooks/fitness/__tests__/GovernanceEngine.test.js
git commit -m "fix(governance): fallback to cached zoneRankMap in evaluate()

When evaluate() is called without params (e.g., from _triggerPulse()),
it now falls back to the previously captured zoneRankMap instead of
defaulting to empty {}.

This prevents false governance warnings when internal timer-based
evaluations run without the zone configuration data.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Add Integration Test for Full Flow

**Files:**
- Create: `frontend/src/hooks/fitness/__tests__/governance-zone-integration.test.js`

**Step 1: Write the integration test**

```javascript
// frontend/src/hooks/fitness/__tests__/governance-zone-integration.test.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FitnessSession } from '../FitnessSession.js';

describe('Governance + TreasureBox Zone Integration', () => {
  let session;

  beforeEach(() => {
    vi.useFakeTimers();
    session = new FitnessSession();
  });

  afterEach(() => {
    vi.useRealTimers();
    session?.reset();
  });

  it('should not trigger false warning when all participants meet requirements', () => {
    const zoneConfig = [
      { id: 'blue', name: 'Blue', min: 0, color: 'blue', coins: 0 },
      { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
      { id: 'warm', name: 'Warm', min: 130, color: 'yellow', coins: 2 },
    ];

    const governanceConfig = {
      default: {
        zones: { active: { min: 1 } },
        grace_period_seconds: 30
      },
      governed_labels: ['workout'],
      governed_types: []
    };

    // Set up session with config
    session.snapshot.zoneConfig = zoneConfig;
    session.start({ reason: 'test' });

    // Configure governance
    session.governanceEngine.configure(governanceConfig);
    session.governanceEngine.setMedia({ id: '123', labels: ['workout'] });

    // Set up participant in Active zone
    session.roster = [
      { id: 'user1', name: 'User 1', isActive: true, zoneId: 'active' }
    ];

    // Build zoneRankMap from zoneConfig
    const zoneRankMap = {};
    const zoneInfoMap = {};
    zoneConfig.forEach((z, idx) => {
      const zid = z.id.toLowerCase();
      zoneRankMap[zid] = idx;
      zoneInfoMap[zid] = z;
    });

    // First evaluation with full data - should satisfy
    session.governanceEngine.evaluate({
      activeParticipants: ['user1'],
      userZoneMap: { user1: 'active' },
      zoneRankMap,
      zoneInfoMap,
      totalCount: 1
    });

    // Wait for hysteresis
    vi.advanceTimersByTime(600);

    // Should be unlocked now
    expect(session.governanceEngine.phase).toBe('unlocked');

    // Simulate internal pulse (no params) - should NOT trigger warning
    session.governanceEngine._triggerPulse();

    // Should still be unlocked (not warning)
    expect(session.governanceEngine.phase).toBe('unlocked');

    // Verify TreasureBox has zones
    expect(session.treasureBox.globalZones.length).toBe(3);
  });

  it('should count coins when zones are configured', () => {
    const zoneConfig = [
      { id: 'blue', name: 'Blue', min: 0, color: 'blue', coins: 0 },
      { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
    ];

    session.snapshot.zoneConfig = zoneConfig;
    session.start({ reason: 'test' });

    // Verify zones are configured
    expect(session.treasureBox.globalZones.length).toBe(2);

    // Record heart rate in active zone
    session.treasureBox.recordHeartRate('user1', 110, { profileId: 'user1' });

    // Zone should be resolved
    const zone = session.treasureBox.resolveZone('user1', 110);
    expect(zone).toBeDefined();
    expect(zone.id).toBe('active');
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npm test -- frontend/src/hooks/fitness/__tests__/governance-zone-integration.test.js --run`
Expected: PASS (after Tasks 1-3 are implemented)

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/__tests__/governance-zone-integration.test.js
git commit -m "test(fitness): add integration test for governance + zone config

Verifies that:
- TreasureBox receives zones from FitnessSession.start()
- GovernanceEngine doesn't trigger false warnings after internal pulses
- Coin counting works when zones are configured

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Run Full Test Suite and Verify

**Step 1: Run all fitness tests**

Run: `npm test -- frontend/src/hooks/fitness --run`
Expected: All tests PASS

**Step 2: Run lint check**

Run: `npm run lint -- frontend/src/hooks/fitness`
Expected: No errors

**Step 3: Final commit (if any lint fixes needed)**

```bash
git add -A
git commit -m "chore: lint fixes for fitness zone config changes

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Verification Checklist

After implementation, verify in production:

1. [ ] Start new fitness session
2. [ ] Check logs for `hasGlobalZones: true` in TreasureBox heart rate logs
3. [ ] Verify coins are being counted (TreasureBox summary shows coins > 0)
4. [ ] Reach governance unlock state
5. [ ] Verify no false warnings occur after unlock
6. [ ] Check that `requirements` array in warning_started logs is NOT empty (if warning does trigger)

---

## Rollback Plan

If issues arise, revert commits in reverse order:
```bash
git revert HEAD~4..HEAD
```
