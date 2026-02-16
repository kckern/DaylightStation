# Governance Engine Lifecycle Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the governance engine's ghost participant oscillation bug and eliminate the dual-path evaluation race condition that causes phase thrashing, video pause/resume cycling, and excessive renders.

**Architecture:** The GovernanceEngine has two callers of `evaluate()` — the internal `_triggerPulse()` (timer/TreasureBox callbacks) and the external `updateSnapshot()` (React re-render). The pulse path builds an empty `userZoneMap` and filters out all participants before the ZoneProfileStore can populate zone data, causing a `pending` phase that immediately gets corrected by the snapshot path, creating a rapid oscillation loop. The fix unifies data gathering so ALL evaluate paths read from ZoneProfileStore, moves the ghost filter to after zone population, removes redundant hysteresis, and eliminates the `_triggerPulse()` call from TreasureBox mutations.

**Tech Stack:** React, plain JS classes, Playwright (E2E tests), Vitest (unit tests)

---

## Bug Summary

From `docs/_wip/audits/2026-02-16-governance-ghost-participant-oscillation.md`:

- **13 rapid phase flips in 20 seconds** (unlocked -> pending -> unlocked -> pending...)
- **4 video pause/resume cycles in 3 seconds**
- **1,787 renders in 90 seconds**
- **Session ended after only 3 minutes** due to empty roster timeout

Root cause: Two competing `evaluate()` paths with different data completeness create an oscillation cycle.

## Changes Overview

| # | File | Change |
|---|------|--------|
| 1 | `GovernanceEngine.js` | Reorder ghost filter to after ZoneProfileStore population |
| 2 | `GovernanceEngine.js` | Make `evaluate()` always self-populate from ZoneProfileStore (no empty-map path) |
| 3 | `GovernanceEngine.js` | Remove 1500ms hysteresis (`_hysteresisMs`) — redundant with warning/grace period |
| 4 | `GovernanceEngine.js` | Remove 5000ms relock grace (`_relockGraceMs`) — replaced by unified grace period path |
| 5 | `FitnessContext.jsx` | Remove `_triggerPulse()` from TreasureBox mutation callback |
| 6 | Unit tests | Update existing + add regression tests |

---

### Task 1: Write regression test for ghost participant oscillation

**Files:**
- Create: `tests/unit/governance/governance-ghost-oscillation-regression.test.mjs`

**Step 1: Write the failing test**

This test reproduces the exact bug: calling `evaluate()` without explicit zone data (like `_triggerPulse()` does) should NOT drop participants to 0 and set phase to `pending` when ZoneProfileStore has valid zone data.

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger before importing GovernanceEngine
vi.mock('../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    sampled: vi.fn()
  })
}));

import { GovernanceEngine } from '../../frontend/src/hooks/fitness/GovernanceEngine.js';

/**
 * Regression test for the ghost participant oscillation bug.
 *
 * Bug: When evaluate() is called without explicit userZoneMap (as _triggerPulse does),
 * the ghost participant filter runs BEFORE ZoneProfileStore population, removing all
 * participants. This causes phase to flip to 'pending', which triggers a React re-render,
 * which calls updateSnapshot() with full data, which evaluates to 'unlocked', which
 * triggers _triggerPulse again, creating an oscillation loop.
 *
 * See: docs/_wip/audits/2026-02-16-governance-ghost-participant-oscillation.md
 */
describe('GovernanceEngine - Ghost Participant Oscillation Regression', () => {
  let engine;
  let mockSession;

  beforeEach(() => {
    // Build a mock session with roster and ZoneProfileStore
    mockSession = {
      roster: [
        { id: 'felix', profileId: 'felix', name: 'Felix', isActive: true },
        { id: 'alan', profileId: 'alan', name: 'Alan', isActive: true }
      ],
      zoneProfileStore: {
        getProfile: (userId) => {
          const profiles = {
            felix: { currentZoneId: 'active' },
            alan: { currentZoneId: 'warm' }
          };
          return profiles[userId] || null;
        }
      }
    };

    engine = new GovernanceEngine(mockSession);
    engine.configure({
      governed_labels: ['aerobics'],
      grace_period_seconds: 30,
      policies: {
        default: {
          base_requirement: [{ active: 'all' }]
        }
      },
      zoneConfig: [
        { id: 'cool', name: 'Cool', min: 0, color: 'blue', coins: 0 },
        { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
        { id: 'warm', name: 'Warm', min: 120, color: 'yellow', coins: 3 },
        { id: 'hot', name: 'Hot', min: 140, color: 'orange', coins: 5 },
        { id: 'fire', name: 'Fire', min: 160, color: 'red', coins: 7 }
      ]
    });

    // Set governed media so governance is active
    engine.setMedia({ id: 'test-media', labels: ['Aerobics'] });
  });

  it('evaluate() without explicit zone data should NOT drop participants to 0', () => {
    // First call with full data — should unlock
    engine.evaluate({
      activeParticipants: ['felix', 'alan'],
      userZoneMap: { felix: 'active', alan: 'warm' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { cool: { id: 'cool', name: 'Cool' }, active: { id: 'active', name: 'Active' }, warm: { id: 'warm', name: 'Warm' }, hot: { id: 'hot', name: 'Hot' }, fire: { id: 'fire', name: 'Fire' } },
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');

    // Now call without explicit zone data (like _triggerPulse does)
    // This should read from roster + ZoneProfileStore, NOT drop to pending
    engine.evaluate();

    // CRITICAL: Phase must remain 'unlocked' — NOT 'pending'
    expect(engine.phase).toBe('unlocked');
    expect(engine._latestInputs.activeParticipants.length).toBe(2);
  });

  it('_triggerPulse should not cause phase oscillation when ZoneProfileStore has data', () => {
    const phaseChanges = [];
    engine.setCallbacks({
      onPhaseChange: (phase) => phaseChanges.push(phase),
      onPulse: vi.fn(),
      onStateChange: vi.fn()
    });

    // Establish unlocked state
    engine.evaluate({
      activeParticipants: ['felix', 'alan'],
      userZoneMap: { felix: 'active', alan: 'warm' },
      zoneRankMap: { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 },
      zoneInfoMap: { cool: { id: 'cool', name: 'Cool' }, active: { id: 'active', name: 'Active' }, warm: { id: 'warm', name: 'Warm' }, hot: { id: 'hot', name: 'Hot' }, fire: { id: 'fire', name: 'Fire' } },
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');
    phaseChanges.length = 0; // Clear setup transitions

    // Simulate 10 rapid _triggerPulse calls (what the bug caused)
    for (let i = 0; i < 10; i++) {
      engine._triggerPulse();
    }

    // CRITICAL: No phase changes should have occurred
    expect(phaseChanges).toEqual([]);
    expect(engine.phase).toBe('unlocked');
  });

  it('no-args evaluate should find participants via ZoneProfileStore even with empty userZoneMap', () => {
    // Call evaluate with NO args — engine should self-populate from session.roster + ZoneProfileStore
    engine.evaluate();

    // Should have found participants
    expect(engine._latestInputs.activeParticipants.length).toBe(2);
    expect(engine._latestInputs.userZoneMap).toHaveProperty('felix');
    expect(engine._latestInputs.userZoneMap).toHaveProperty('alan');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/governance/governance-ghost-oscillation-regression.test.mjs`
Expected: FAIL — the ghost filter removes participants before ZoneProfileStore populates

**Step 3: Commit the failing test**

```bash
git add tests/unit/governance/governance-ghost-oscillation-regression.test.mjs
git commit -m "test: add regression test for governance ghost participant oscillation

Reproduces the bug where evaluate() without explicit zone data drops
all participants before ZoneProfileStore can populate zone data,
causing rapid phase oscillation between pending and unlocked."
```

---

### Task 2: Fix ghost participant filter ordering in evaluate()

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`

The ghost participant filter at lines 1241-1253 runs BEFORE ZoneProfileStore population at lines 1266-1280. Move it after.

**Step 1: Reorder the ghost filter**

In `GovernanceEngine.js`, in the `evaluate()` method, find the block at lines 1241-1253:

```javascript
    // Filter out ghost participants — users in the roster but with no zone data.
    // These are disconnected participants whose roster entries are stale.
    if (userZoneMap && typeof userZoneMap === 'object') {
      const beforeCount = activeParticipants.length;
      activeParticipants = activeParticipants.filter(id => id in userZoneMap);
      totalCount = activeParticipants.length;
      if (activeParticipants.length < beforeCount) {
        getLogger().debug('governance.filtered_ghost_participants', {
          removed: beforeCount - activeParticipants.length,
          remaining: activeParticipants.length
        });
      }
    }
```

Move this block to AFTER the ZoneProfileStore population block (lines 1266-1280).

The new order in `evaluate()` should be:

1. Read roster -> build activeParticipants with empty userZoneMap (lines 1200-1210) ✅ no change
2. Zone map fallbacks (lines 1212-1238) ✅ no change
3. **Populate userZoneMap from ZoneProfileStore** (lines 1266-1280) — FIRST
4. **THEN filter ghost participants** (moved from lines 1241-1253) — SECOND
5. Diagnostic warnings (lines 1255-1264) ✅ no change
6. Zone map capture (lines 1282-1289) ✅ no change

**Step 2: Run tests to verify they pass**

Run: `npx vitest run tests/unit/governance/governance-ghost-oscillation-regression.test.mjs`
Expected: All 3 tests PASS

Run: `npx vitest run tests/unit/governance/`
Expected: All existing governance tests still PASS

**Step 3: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js
git commit -m "fix: reorder ghost participant filter after ZoneProfileStore population

The ghost participant filter was running BEFORE ZoneProfileStore
populated userZoneMap, causing all participants to be removed when
evaluate() was called without explicit zone data (e.g., from
_triggerPulse). Now ZoneProfileStore populates zones first, then
the ghost filter runs on populated data.

Fixes: docs/_wip/audits/2026-02-16-governance-ghost-participant-oscillation.md"
```

---

### Task 3: Remove redundant hysteresis from evaluate()

**Files:**
- Modify: `frontend/src/hooks/fitness/GovernanceEngine.js`
- Modify: `tests/unit/governance/governance-hysteresis.test.mjs` (update expectations)

The 1500ms `_hysteresisMs` and 5000ms `_relockGraceMs` are redundant with the warning zone + `grace_period_seconds` (configurable, typically 30s). The hysteresis adds an invisible delay without user-facing feedback. The grace period already handles HR near threshold with a visible countdown.

**Step 1: Remove hysteresis fields from constructor**

In `GovernanceEngine.js` constructor, remove:
```javascript
    this._hysteresisMs = 1500;
    this._lastUnlockTime = null;
    this._relockGraceMs = 5000;
```

And from `meta`:
```javascript
    this.meta = {
      satisfiedOnce: false,
      satisfiedSince: null,  // REMOVE
      deadline: null,
      gracePeriodTotal: null
    };
```

Keep `satisfiedOnce` and `deadline` — they are used by the warning/grace period logic.

**Step 2: Simplify phase determination in evaluate()**

Replace the phase determination block (lines 1413-1489) with simplified logic:

```javascript
    // 6. Determine Phase
    const challengeForcesRed = this.challengeState.activeChallenge && this.challengeState.activeChallenge.status === 'failed';
    const defaultGrace = this.config.grace_period_seconds || 0;
    const baseGraceSeconds = Number.isFinite(baseRequirement.grace_period_seconds) ? baseRequirement.grace_period_seconds : defaultGrace;

    if (challengeForcesRed && !allSatisfied) {
      // Failed challenge + requirements not met -> locked
      if (this.timers.governance) clearTimeout(this.timers.governance);
      this.meta.deadline = null;
      this.meta.gracePeriodTotal = null;
      this._setPhase('locked');
    } else if (allSatisfied) {
      // Requirements met -> unlocked immediately (no hysteresis delay)
      this.meta.satisfiedOnce = true;
      this.meta.deadline = null;
      this.meta.gracePeriodTotal = null;
      this._setPhase('unlocked');
    } else if (!this.meta.satisfiedOnce) {
      // Never been satisfied -> pending
      this.meta.deadline = null;
      this.meta.gracePeriodTotal = null;
      this._setPhase('pending');
    } else {
      // Was satisfied, now failing -> warning with grace period
      let graceSeconds = baseGraceSeconds;
      if (!Number.isFinite(graceSeconds) || graceSeconds <= 0) {
        // No grace period configured -> locked immediately
        if (this.timers.governance) clearTimeout(this.timers.governance);
        this.meta.deadline = null;
        this.meta.gracePeriodTotal = null;
        this._setPhase('locked');
      } else {
        // Start or continue grace period countdown
        if (!Number.isFinite(this.meta.deadline) && this.phase !== 'locked') {
          this.meta.deadline = now + graceSeconds * 1000;
          this.meta.gracePeriodTotal = graceSeconds;
        }

        if (!Number.isFinite(this.meta.deadline)) {
          if (this.timers.governance) clearTimeout(this.timers.governance);
          this.meta.gracePeriodTotal = null;
          this._setPhase('locked');
        } else {
          const remainingMs = this.meta.deadline - now;
          if (remainingMs <= 0) {
            // Grace period expired -> locked
            if (this.timers.governance) clearTimeout(this.timers.governance);
            this.meta.deadline = null;
            this.meta.gracePeriodTotal = null;
            this._setPhase('locked');
          } else {
            // Grace period active -> warning
            if (this.timers.governance) clearTimeout(this.timers.governance);
            this.timers.governance = setTimeout(() => this._triggerPulse(), remainingMs);
            this._setPhase('warning');
          }
        }
      }
    }
```

**Step 3: Clean up _setPhase()**

In `_setPhase()`, remove the `_lastUnlockTime` tracking:
```javascript
  _setPhase(newPhase) {
    if (this.phase !== newPhase) {
      const oldPhase = this.phase;
      const now = Date.now();
      this.phase = newPhase;
-     if (newPhase === 'unlocked') {
-       this._lastUnlockTime = Date.now();
-     }
```

**Step 4: Clean up reset() and _resetToIdle()**

Remove `_lastUnlockTime`, `_hysteresisMs`, `_relockGraceMs`, and `satisfiedSince` references from `reset()` and `_resetToIdle()`.

**Step 5: Update hysteresis tests**

Modify `tests/unit/governance/governance-hysteresis.test.mjs`: The hysteresis tests should now verify that the engine unlocks IMMEDIATELY when requirements are met (no 1500ms delay). Update the test expectations accordingly. Tests that verify "rapid cycling protection" should now verify that the warning/grace period provides that protection instead.

Modify `tests/unit/governance/governance-relock-grace.test.mjs`: The relock grace tests should be updated to verify that the grace period (configurable `grace_period_seconds`) handles the "don't relock immediately" behavior instead of the hardcoded `_relockGraceMs`.

**Step 6: Run tests**

Run: `npx vitest run tests/unit/governance/`
Expected: All tests PASS (with updated expectations)

**Step 7: Commit**

```bash
git add frontend/src/hooks/fitness/GovernanceEngine.js tests/unit/governance/governance-hysteresis.test.mjs tests/unit/governance/governance-relock-grace.test.mjs
git commit -m "fix: remove redundant hysteresis and relock grace from governance

The 1500ms hysteresis delay and 5000ms relock grace were redundant with
the warning zone + grace_period_seconds mechanism. Hysteresis added an
invisible delay without user feedback. Now:
- Requirements met -> unlocked immediately
- Requirements fail after unlock -> warning with configurable grace period
- Grace period expires -> locked

This eliminates a class of edge cases where satisfaction was met but the
user saw no unlock for 1.5s, and where the relock grace bypassed the
normal evaluation path entirely."
```

---

### Task 4: Remove _triggerPulse from TreasureBox mutation callback

**Files:**
- Modify: `frontend/src/context/FitnessContext.jsx`

The TreasureBox mutation callback in FitnessContext (line 636) calls `session.governanceEngine?._triggerPulse()`, which triggers the Path A (no-data) evaluate. This is unnecessary because:
1. `recordDeviceActivity()` already syncs ZoneProfileStore and calls `governanceEngine.notifyZoneChange()` on zone changes
2. `batchedForceUpdate()` triggers `updateSnapshot()` which calls `evaluate()` with full data

**Step 1: Remove the _triggerPulse call**

In `FitnessContext.jsx`, find the TreasureBox mutation callback (around line 632-638):

```javascript
    box.setMutationCallback(() => {
      // Trigger governance re-evaluation when TreasureBox mutates (HR data arrives).
      // Without this, GovernanceEngine stays stuck at 0 participants and the lock screen
      // shows "Waiting for participant data..." even when the sidebar already has HR data.
      session.governanceEngine?._triggerPulse();
      batchedForceUpdate();
    });
```

Replace with:

```javascript
    box.setMutationCallback(() => {
      // TreasureBox mutated (HR data / coin update).
      // Governance re-evaluation happens via:
      //   1. recordDeviceActivity() -> ZoneProfileStore sync -> notifyZoneChange()
      //   2. batchedForceUpdate() -> updateSnapshot() -> evaluate() with full data
      // Calling _triggerPulse() here caused the ghost participant oscillation bug
      // because it evaluated with empty userZoneMap before ZoneProfileStore could populate it.
      batchedForceUpdate();
    });
```

**Step 2: Run all governance tests**

Run: `npx vitest run tests/unit/governance/`
Expected: All PASS

**Step 3: Commit**

```bash
git add frontend/src/context/FitnessContext.jsx
git commit -m "fix: remove _triggerPulse from TreasureBox mutation callback

The TreasureBox mutation callback was calling _triggerPulse() which
triggered evaluate() with empty zone data, contributing to the ghost
participant oscillation. Governance re-evaluation already happens via
recordDeviceActivity -> notifyZoneChange and updateSnapshot -> evaluate.

Ref: docs/_wip/audits/2026-02-16-governance-ghost-participant-oscillation.md"
```

---

### Task 5: Write integration test for end-to-end phase stability

**Files:**
- Create: `tests/unit/governance/governance-phase-stability-e2e.test.mjs`

This test simulates the full lifecycle: HR data arrives -> DeviceManager -> UserManager -> ZoneProfileStore -> GovernanceEngine, verifying no spurious phase transitions.

**Step 1: Write the test**

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../frontend/src/lib/logging/Logger.js', () => ({
  default: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    sampled: vi.fn()
  })
}));

import { GovernanceEngine } from '../../frontend/src/hooks/fitness/GovernanceEngine.js';

describe('GovernanceEngine - Phase Stability Integration', () => {
  let engine;
  let phaseLog;

  function buildMockSession(zones = {}) {
    return {
      roster: Object.keys(zones).map(id => ({
        id, profileId: id, name: id, isActive: true
      })),
      zoneProfileStore: {
        getProfile: (userId) => {
          const zoneId = zones[userId];
          return zoneId ? { currentZoneId: zoneId } : null;
        }
      }
    };
  }

  const ZONE_CONFIG = [
    { id: 'cool', name: 'Cool', min: 0, color: 'blue', coins: 0 },
    { id: 'active', name: 'Active', min: 100, color: 'green', coins: 1 },
    { id: 'warm', name: 'Warm', min: 120, color: 'yellow', coins: 3 },
    { id: 'hot', name: 'Hot', min: 140, color: 'orange', coins: 5 },
    { id: 'fire', name: 'Fire', min: 160, color: 'red', coins: 7 }
  ];

  const ZONE_RANK_MAP = { cool: 0, active: 1, warm: 2, hot: 3, fire: 4 };
  const ZONE_INFO_MAP = Object.fromEntries(ZONE_CONFIG.map(z => [z.id, { id: z.id, name: z.name }]));

  beforeEach(() => {
    phaseLog = [];
  });

  function createEngine(zones) {
    const session = buildMockSession(zones);
    const eng = new GovernanceEngine(session);
    eng.configure({
      governed_labels: ['aerobics'],
      grace_period_seconds: 30,
      policies: {
        default: {
          base_requirement: [{ active: 'all' }]
        }
      },
      zoneConfig: ZONE_CONFIG
    });
    eng.setMedia({ id: 'test', labels: ['Aerobics'] });
    eng.setCallbacks({
      onPhaseChange: (phase) => phaseLog.push({ phase, ts: Date.now() }),
      onPulse: vi.fn(),
      onStateChange: vi.fn()
    });
    return eng;
  }

  it('should transition pending -> unlocked with zero oscillation', () => {
    engine = createEngine({ felix: 'active', alan: 'warm' });

    // First evaluation with explicit data (simulates updateSnapshot path)
    engine.evaluate({
      activeParticipants: ['felix', 'alan'],
      userZoneMap: { felix: 'active', alan: 'warm' },
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 2
    });

    expect(engine.phase).toBe('unlocked');
    // Should have exactly ONE phase change: pending -> unlocked
    const uniquePhases = phaseLog.map(p => p.phase);
    expect(uniquePhases).toEqual(['unlocked']);
  });

  it('should maintain unlocked through mixed evaluate paths', () => {
    engine = createEngine({ felix: 'active', alan: 'warm' });

    // Path B (with data) -> unlocked
    engine.evaluate({
      activeParticipants: ['felix', 'alan'],
      userZoneMap: { felix: 'active', alan: 'warm' },
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');
    phaseLog.length = 0;

    // Path A (no data, like _triggerPulse) -> should stay unlocked
    engine.evaluate();
    expect(engine.phase).toBe('unlocked');

    // Path B again
    engine.evaluate({
      activeParticipants: ['felix', 'alan'],
      userZoneMap: { felix: 'active', alan: 'warm' },
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');

    // Path A again
    engine.evaluate();
    expect(engine.phase).toBe('unlocked');

    // NO phase changes should have occurred
    expect(phaseLog).toEqual([]);
  });

  it('unlocked -> warning transition should happen exactly once when HR drops', () => {
    // Start with everyone in active zone
    engine = createEngine({ felix: 'active', alan: 'active' });
    engine.evaluate({
      activeParticipants: ['felix', 'alan'],
      userZoneMap: { felix: 'active', alan: 'active' },
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');
    phaseLog.length = 0;

    // Now alan drops to cool zone
    engine.session = buildMockSession({ felix: 'active', alan: 'cool' });
    engine.evaluate({
      activeParticipants: ['felix', 'alan'],
      userZoneMap: { felix: 'active', alan: 'cool' },
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 2
    });

    expect(engine.phase).toBe('warning');
    // Exactly one transition: unlocked -> warning
    expect(phaseLog.map(p => p.phase)).toEqual(['warning']);
  });

  it('warning -> unlocked recovery should be immediate (no hysteresis delay)', () => {
    // Start unlocked
    engine = createEngine({ felix: 'active', alan: 'active' });
    engine.evaluate({
      activeParticipants: ['felix', 'alan'],
      userZoneMap: { felix: 'active', alan: 'active' },
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 2
    });
    expect(engine.phase).toBe('unlocked');

    // Drop to warning
    engine.session = buildMockSession({ felix: 'active', alan: 'cool' });
    engine.evaluate({
      activeParticipants: ['felix', 'alan'],
      userZoneMap: { felix: 'active', alan: 'cool' },
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 2
    });
    expect(engine.phase).toBe('warning');

    // Recover immediately (alan back to active)
    engine.session = buildMockSession({ felix: 'active', alan: 'active' });
    engine.evaluate({
      activeParticipants: ['felix', 'alan'],
      userZoneMap: { felix: 'active', alan: 'active' },
      zoneRankMap: ZONE_RANK_MAP,
      zoneInfoMap: ZONE_INFO_MAP,
      totalCount: 2
    });

    // Should be unlocked immediately — no 1500ms hysteresis wait
    expect(engine.phase).toBe('unlocked');
  });
});
```

**Step 2: Run test**

Run: `npx vitest run tests/unit/governance/governance-phase-stability-e2e.test.mjs`
Expected: All PASS (these should pass after Tasks 2-4)

**Step 3: Commit**

```bash
git add tests/unit/governance/governance-phase-stability-e2e.test.mjs
git commit -m "test: add phase stability integration tests for governance

Tests the full lifecycle: HR data arrival through phase transitions,
verifying zero spurious oscillation across mixed evaluate paths and
immediate recovery from warning to unlocked (no hysteresis delay)."
```

---

### Task 6: Run full test suite and fix any regressions

**Files:**
- Possibly modify: Various test files

**Step 1: Run all governance unit tests**

Run: `npx vitest run tests/unit/governance/`
Expected: All PASS

**Step 2: Run all fitness unit tests**

Run: `npx vitest run tests/unit/fitness/`
Expected: All PASS

**Step 3: Run all isolated domain tests**

Run: `npx vitest run tests/isolated/domain/fitness/`
Expected: All PASS

**Step 4: Fix any failures**

If any existing tests fail, the most likely causes are:
- Tests that relied on `_hysteresisMs` delay (update to expect immediate unlock)
- Tests that relied on `_relockGraceMs` (update to use grace period instead)
- Tests that relied on `satisfiedSince` tracking (remove references)
- Tests that relied on `_lastUnlockTime` (remove references)

For each failure: read the test, understand what it was testing, and update expectations to match the new behavior. DO NOT remove tests — update them to test the same invariant with the new mechanism.

**Step 5: Commit any fixes**

```bash
git add -A tests/
git commit -m "fix: update existing governance tests for simplified phase logic

Updated tests that relied on removed hysteresis/relock-grace mechanisms
to verify the same invariants using the warning/grace-period mechanism."
```

---

### Task 7: Verify with dev server (manual)

**Step 1: Start dev server**

Run: `lsof -i :3111` to check if already running.
If not running: `npm run dev`

**Step 2: Open fitness app and verify**

1. Navigate to fitness app in browser
2. Start HR simulation (if available)
3. Play governed content
4. Verify:
   - Lock screen shows participants (not "Waiting for participant data...")
   - Phase transitions are smooth (no flickering)
   - Video doesn't pause/resume rapidly
   - Console shows no `governance.evaluate.no_participants` warnings during active session

**Step 3: Final commit with docs update**

```bash
git mv docs/_wip/audits/2026-02-16-governance-ghost-participant-oscillation.md docs/_archive/2026-02-16-governance-ghost-participant-oscillation.md
git add docs/_archive/
git commit -m "docs: archive resolved governance oscillation audit"
```

---

## Risk Assessment

| Change | Risk | Mitigation |
|--------|------|------------|
| Ghost filter reorder | Low | Only changes execution order, not logic |
| Remove hysteresis | Medium | Zone boundary jitter now handled by ZoneProfileStore's own hysteresis (3s/5s). Grace period handles the "HR near threshold" UX |
| Remove relock grace | Medium | Grace period (30s default) provides the same "don't lock immediately" behavior with user-visible countdown |
| Remove TreasureBox _triggerPulse | Low | Governance still evaluates via notifyZoneChange() and updateSnapshot() |

## Dependencies

- ZoneProfileStore already has its own hysteresis (3s stability, 5s cooldown) — this protects against visual zone jitter at zone boundaries
- `grace_period_seconds` in config (default 30s) provides the "don't lock immediately" behavior that `_relockGraceMs` was doing
- `notifyZoneChange()` (called from `recordDeviceActivity()`) ensures governance evaluates promptly on zone changes
