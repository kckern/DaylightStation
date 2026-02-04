# Bug Report: Governance Test Flakiness

**Date:** 2026-02-03
**Severity:** Medium
**Component:** GovernanceEngine / Fitness Tests
**Test File:** `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs`

---

## Summary

The governance comprehensive test suite exhibits significant flakiness, with 4 of 6 tests failing intermittently. The root cause is a **zone requirement mismatch** between what the tests send and what the GovernanceEngine expects.

---

## Symptoms

### Test Results (Current State)

| Test | Status | Notes |
|------|--------|-------|
| `hydration-hr-first` | ✅ Pass | Consistent |
| `hydration-video-first` | ❌ Flaky | Can't observe "waiting" state |
| `challenge-success` | ❌ Fail | Phase doesn't stabilize to `unlocked` |
| `challenge-fail-recover` | ❌ Fail | Phase doesn't stabilize to `unlocked` |
| `grace-expire-lock` | ✅ Pass | Usually works |
| `grace-recover-normal` | ❌ Flaky | Warning phase not always triggered |

### Observable Behavior

1. **Unlock sequence completes but phase stays `pending`:**
   ```
   [UNLOCK] Moving users to target zone...
     Video unlocked!
     WARNING: Governance phase is pending, not 'unlocked'
   ```

2. **Phase cycles incorrectly on zone drop:**
   ```
   Phase changed: pending → unlocked
   Phase changed: unlocked → pending    // Should be: unlocked → warning
   ```

3. **Warning phase eventually appears but too late:**
   ```
   Phase changed: pending → warning
   Warning appeared! Duration: 219ms
   ```

---

## Root Cause Analysis

### 1. Zone Requirement Mismatch

**Governance Config (from API):**
```json
{
  "policies": {
    "default": {
      "base_requirement": [
        { "active": "all" }
      ]
    }
  }
}
```

**Test Behavior:**
- Tests call `sim.setZone(device.deviceId, 'warm')` to unlock
- The `'warm'` zone is **below** the `'active'` zone in the rank hierarchy

**Zone Hierarchy (lowest to highest):**
```
cool → warm → active → hot
```

### 2. UI vs Engine Discrepancy

There's a discrepancy between what causes the **UI overlay to disappear** vs what causes the **GovernanceEngine to transition to `unlocked` phase**:

| Behavior | Zone Required |
|----------|--------------|
| Lock screen overlay disappears | `warm` (or maybe any HR?) |
| GovernanceEngine phase → `unlocked` | `active` (per config) |

This means:
- The overlay disappears → test thinks video is "unlocked"
- But GovernanceEngine stays in `pending` phase
- `satisfiedOnce` flag is never set to `true`
- On zone drop → goes to `pending` instead of `warning`

### 3. Hysteresis Timing

The GovernanceEngine has a 500ms hysteresis requirement:
```javascript
this._hysteresisMs = 500;

if (satisfiedDuration >= this._hysteresisMs) {
  this.meta.satisfiedOnce = true;
  this._setPhase('unlocked');
}
```

Even if requirements are briefly satisfied, they must remain satisfied for 500ms before `satisfiedOnce` is set.

### 4. Timing-Sensitive Tests

The `hydration-video-first` test tries to observe an empty lock screen before HR arrives. In a live environment with WebSocket connections, HR data may arrive before the test can observe the empty state.

---

## Evidence

### dev.log Shows Correct Transitions (Sometimes)

```json
{
  "event": "governance.phase_change",
  "data": {
    "from": "unlocked",
    "to": "warning",
    "satisfiedOnce": true
  }
}
```

This proves the GovernanceEngine CAN work correctly when `satisfiedOnce` is properly set.

### Test Output Shows Incorrect Transitions

```
Phase changed: unlocked → pending
```

This happens when `satisfiedOnce` is `false`, causing the engine to treat the zone drop as a fresh unsatisfied state rather than a grace period violation.

---

## Affected Code Paths

### GovernanceEngine.evaluate() - Phase Decision Logic

```javascript
// frontend/src/hooks/fitness/GovernanceEngine.js:1379-1418

} else if (!this.meta.satisfiedOnce) {
  // Goes here when satisfiedOnce is false
  this._setPhase('pending');  // ← Bug: Should be warning if was previously unlocked
} else {
  // Grace period logic - only reached when satisfiedOnce is true
  this._setPhase('warning');
}
```

### FitnessSimulationController.triggerChallenge()

```javascript
// frontend/src/modules/Fitness/FitnessSimulationController.js:526-551

// Delegates to real GovernanceEngine, but challenge only works in unlocked phase
const session = this.getSession?.();
if (session?.governanceEngine?.triggerChallenge) {
  session.governanceEngine.triggerChallenge(payload);
  return { ok: true, delegated: true, ...opts };
}
```

Challenges are delegated but fail silently if phase isn't `unlocked`.

---

## Recommendations

### Option A: Fix Tests to Match Config (Recommended)

Update tests to use `'active'` zone instead of `'warm'`:

```javascript
// In unlockVideo() and other test helpers
for (const device of devices) {
  await sim.setZone(device.deviceId, 'active');  // Not 'warm'
}
```

**Pros:**
- Tests match real-world config
- No production code changes
- Makes tests more realistic

**Cons:**
- May need to update multiple test files
- Tests become coupled to specific config

### Option B: Use Test-Specific Governance Config

Create a test governance config with lower requirements:

```javascript
await sim.enableGovernance({
  baseRequirement: { warm: 'all' },  // Match what tests send
  // ...
});
```

**Pros:**
- Tests are self-contained
- Doesn't depend on production config

**Cons:**
- May hide real-world issues
- Config divergence risk

### Option C: Fix the UI/Engine Discrepancy

Investigate why the lock screen overlay disappears when requirements aren't actually met. The UI should stay locked if GovernanceEngine says `pending`.

**Pros:**
- Fixes potential production bug
- Makes behavior consistent

**Cons:**
- Requires deeper investigation
- May be intentional UX design

### Option D: Add Phase Stabilization Wait

Update `unlockVideo()` to wait for governance phase to stabilize:

```javascript
async function unlockVideo(page, sim, devices, timeline, issues) {
  // ... existing unlock logic ...

  // Wait for phase to actually be 'unlocked' (not just overlay hidden)
  for (let i = 0; i < 50; i++) {
    const govState = await extractGovernanceState(page);
    if (govState?.phase === 'unlocked') {
      console.log('  Governance phase confirmed: unlocked');
      break;
    }
    // Keep sending HR to maintain requirements
    for (const device of devices) {
      await sim.setZone(device.deviceId, 'active');
    }
    await page.waitForTimeout(200);
  }
}
```

**Pros:**
- More robust tests
- Catches phase instability

**Cons:**
- Longer test runtime
- Treats symptom not cause

---

## Recommended Action Plan

1. **Immediate:** Update tests to use `'active'` zone (Option A)
2. **Short-term:** Add phase stabilization wait (Option D) as defensive measure
3. **Medium-term:** Investigate UI/Engine discrepancy (Option C) to understand if this is a bug

---

## Related Files

- `frontend/src/hooks/fitness/GovernanceEngine.js` - State machine logic
- `frontend/src/modules/Fitness/FitnessSimulationController.js` - Test simulator
- `tests/live/flow/fitness/governance-comprehensive.runtime.test.mjs` - Test file
- `data/household/apps/fitness/config.yml` - Governance config (production)

---

## Appendix: Zone Mapping

From the fitness API:
```json
{
  "zoneConfig": [
    { "id": "cool", "name": "Cool", "rank": 0 },
    { "id": "warm", "name": "Warm", "rank": 1 },
    { "id": "active", "name": "Active", "rank": 2 },
    { "id": "hot", "name": "Hot", "rank": 3 }
  ]
}
```

The base requirement `"active": "all"` means all (non-exempt) participants must have zone rank >= 2.
