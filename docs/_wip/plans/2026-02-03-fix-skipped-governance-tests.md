# Plan: Fix Skipped Governance Tests

**Date:** 2026-02-03
**Status:** Draft

---

## Problem Summary

Two governance tests are skipped:
1. `hydration-video-first` - Can't observe transient "waiting" state
2. `challenge-fail-recover` - Zone updates don't propagate for all users

## Root Cause Analysis

### Finding 1: Per-User Zone Thresholds

Users have age-adjusted zone configurations:

| User | Active Min | Warm Min | Hot Min |
|------|------------|----------|---------|
| kckern (adult) | 100 | 120 | 140 |
| felix (child) | 120 | 140 | 160 |
| milo (child) | 120 | 140 | 165 |
| alan (young child) | 125 | 150 | 170 |
| soren (young child) | 125 | 150 | 170 |

The simulator uses global zone midpoints:
- `warm` → HR=130

At HR=130:
- kckern: 130 >= 120 → warm (correct)
- felix: 130 < 140 → active (not warm!)
- alan: 130 < 150 → active (not warm!)

**Impact:** Tests expecting all users in "warm" zone fail because children are in "active".

### Finding 2: Zone Sync Throttle

`ZoneProfileStore._scheduleZoneProfileSync()` has a 1000ms minimum interval between syncs.

- Updates arrive at DeviceManager immediately
- Zone derivation happens 1000ms later (or on next sync)
- Tests checking zones immediately see stale data

**Impact:** Tests pass eventually but fail if they check zones too quickly.

### Finding 3: Not a Propagation Bug

Both rapid and delayed updates eventually propagate correctly. The diagnostic tests showed:
- After 500ms: Some devices show HR=0 (sync pending)
- After 2000ms: All devices show correct HR

The system works correctly; tests just need proper timing.

---

## Solution Design

### Fix for hydration-video-first

**Option A: Accept the limitation (Recommended)**

The "waiting" state is transient and not reliably observable. This is a test environment issue, not a production bug. The test should:
1. Verify the final state is correct (fully hydrated + unlocked)
2. Accept that intermediate states may not be observable
3. Document this as a known limitation

**Option B: Mock the hydration timing**

Use page events or mutation observers to catch the transient state. This adds complexity for minimal value.

**Recommendation:** Keep the test skipped or convert to a simpler test that verifies end state.

### Fix for challenge-fail-recover

**Problem:** The test uses `setZone('active')` which sends HR=115 (midpoint). This is below children's thresholds for reliable zone matching.

**Fix:**
1. Use explicit HR values that put ALL users in the same zone
2. Wait for zone sync (1500ms+) after HR changes before checking governance state
3. Verify zones actually propagated before proceeding

**Specific changes:**

```javascript
// Instead of:
await sim.setZone(device.deviceId, 'active');

// Use explicit HR that works for ALL users:
// HR=135 puts everyone in "active" (above 125, below 140)
await sim.setHR(device.deviceId, 135);

// And wait for sync:
await page.waitForTimeout(1500);

// Verify zones propagated:
const state = await extractGovernanceState(page);
const allActive = Object.values(state.userZoneMap).every(z => z === 'active');
if (!allActive) throw new Error('Zone sync failed');
```

**For the "hot" zone challenge:**
- HR=175 puts everyone in "hot" (above 170, the highest hotMin)

---

## Implementation Tasks

### Task 1: Create helper for universal HR values

Add a helper that calculates HR values that work for all users:

```javascript
// tests/_lib/fitnessTestHelpers.mjs
export const UNIVERSAL_HR = {
  cool: 70,      // Below 85 (lowest active min)
  active: 135,   // 125-139 (above alan/soren active, below felix warm)
  warm: 155,     // 150-164 (above alan/soren warm, below milo hot)
  hot: 175,      // 170-179 (above alan/soren hot, below felix fire)
  fire: 195      // Above 190 (highest fire min)
};
```

### Task 2: Update unlockVideo() helper

Modify `unlockVideo()` in governance-comprehensive.runtime.test.mjs:

1. Use `sim.setHR()` with universal values instead of `sim.setZone()`
2. Add 1500ms wait after bulk HR updates
3. Verify zone propagation before proceeding

### Task 3: Update runChallengeFailRecover()

1. Use universal HR values for "active" zone maintenance
2. Wait for zone sync before checking governance state
3. Add diagnostic logging for zone propagation verification

### Task 4: Re-enable and test

1. Remove `skip` from challenge-fail-recover scenario
2. Run test multiple times to verify reliability
3. Update hydration-video-first to test end-state only (or keep skipped)

---

## Test Verification

After implementation, verify:

1. `challenge-fail-recover` passes consistently (5+ runs)
2. All other governance tests still pass
3. No flaky behavior introduced

---

## Files to Modify

| File | Changes |
|------|---------|
| `tests/_lib/fitnessTestHelpers.mjs` | Add UNIVERSAL_HR constants (new file or existing) |
| `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs` | Update helpers and unskip test |

---

## Risks

1. **Different production config:** If production has different zone configs, universal HR values may not work. Mitigation: Read zone configs dynamically.

2. **Timing sensitivity:** 1500ms waits increase test runtime. Mitigation: Only add waits where necessary.

---

## Appendix: Diagnostic Test Files

Created during investigation (can be deleted after fix):
- `tests/live/flow/fitness/zone-propagation-diagnosis.runtime.test.mjs`
- `tests/live/flow/fitness/zone-config-check.runtime.test.mjs`
- `tests/live/flow/fitness/zone-propagation-fixed.runtime.test.mjs`
- `tests/live/flow/fitness/propagation-minimal-repro.runtime.test.mjs`
